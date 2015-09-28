package com.ilmservice.personalbudget.data;

import java.nio.ByteBuffer;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

import com.google.protobuf.InvalidProtocolBufferException;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;
import com.ilmservice.repository.IRepository;
import com.ilmservice.repository.IRepository.IRepositoryIndex;

@Default
@Stateless
public class EventStore implements IEventStore {

	@Inject private IRepository<Event> events;
	private IRepositoryIndex<Integer, Event> eventsById;
	
	@PostConstruct
	public void configure() {
		events.configure( 
			(bytes) -> Event.parseFrom(bytes),
			(event) -> event.toByteArray()
		);
		
		eventsById = events.configureIndex(
			Indexes.EventsById.getValue(),
			(k) -> Event.newBuilder().setId(k).build(),
			(v) -> v.getId(),
			(k) -> ByteBuffer.allocate(4).putInt(k).array()
			
		);
	}
	
	@Override
	public void uploadSpreadsheet(UploadSpreadsheetEvent event) {
		
	}
}
