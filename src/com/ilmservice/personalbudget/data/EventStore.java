package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Date;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.context.Dependent;
import javax.enterprise.context.RequestScoped;
import javax.enterprise.inject.Default;
import javax.inject.Inject;
import javax.inject.Singleton;

import com.google.protobuf.InvalidProtocolBufferException;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;
import com.ilmservice.repository.IDbScope;
import com.ilmservice.repository.IRepository;
import com.ilmservice.repository.NoTransaction;
import com.ilmservice.repository.IRepository.IRepositoryIndex;

@Default
@Singleton
public class EventStore implements IEventStore {

	@Inject 
	@NoTransaction
	private IDbScope scope;
	
	@Inject 
	private IRepository<Event> events;
	
	private IRepositoryIndex<DateUserKey, Event> eventsByDateUser;
	
	public class DateUserKey {
		public final Date date;
		public final int userId;
		
		public DateUserKey (Date date, int userId) {
			this.date = date;
			this.userId = userId;
		}
	}
	
	@PostConstruct
	public void configure() {
		System.out.println("eventstore configuring   ");
		events.configure( 
			scope,
			(bytes) -> Event.parseFrom(bytes),
			(event) -> event.toByteArray(),
			() -> {
				try {
					System.out.println("eventstore indexes  ");
					eventsByDateUser = events.configureIndex(
						Indexes.EventsById.getValue(),
						false,
						(k) -> Event.newBuilder().setDate(k.date.getTime()).build(),
						(v) -> new DateUserKey(new Date(v.getDate()), v.getUserId()),
						(k) -> ByteBuffer.allocate(12).putLong(k.date.getTime()).putInt(k.userId).array()
					);
				} catch (Exception e) {
					e.printStackTrace();
				}
			}
		);
	}

	public void put (Event event) throws IOException {
		events.put(event);
	}
}
