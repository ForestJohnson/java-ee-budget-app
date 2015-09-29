package com.ilmservice.personalbudget.data;

import java.nio.ByteBuffer;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.context.Dependent;
import javax.enterprise.inject.Default;
import javax.inject.Inject;
import javax.inject.Singleton;

import com.google.protobuf.InvalidProtocolBufferException;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;
import com.ilmservice.repository.IRepository;
import com.ilmservice.repository.IRepository.IRepositoryIndex;

@Default
@Singleton
public class EventStore implements IEventStore {

	@Inject public IRepository<Event> events;
	public IRepositoryIndex<Integer, Event> eventsById;
	
	@PostConstruct
	public void configure() {
		System.out.println("eventstore configuring");
		events.configure( 
			(bytes) -> Event.parseFrom(bytes),
			(event) -> event.toByteArray(),
			() -> {
				try {
					System.out.println("eventstore indexes");
					eventsById = events.configureIndex(
						Indexes.EventsById.getValue(),
						(k) -> Event.newBuilder().setId(k).build(),
						(v) -> v.getId(),
						(k) -> ByteBuffer.allocate(4).putInt(k).array()
					);
				} catch (Exception e) {
					e.printStackTrace();
				}
			}
		);
		
		
	}

}
