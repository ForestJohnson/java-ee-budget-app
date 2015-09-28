package com.ilmservice.personalbudget.service;

import java.nio.ByteBuffer;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

import com.google.protobuf.InvalidProtocolBufferException;
import com.ilmservice.personalbudget.data.IRepository;
import com.ilmservice.personalbudget.data.IRepository.IRepositoryIndex;
import com.ilmservice.personalbudget.data.Index;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;

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
			Index.EventsById,
			(k) -> Event.newBuilder().setId(k).build(),
			(v) -> v.getId(),
			(k) -> ByteBuffer.allocate(4).putInt(k).array()

		);
	}
	
	@Override
	public void uploadSpreadsheet(UploadSpreadsheetEvent event) {
		// TODO Auto-generated method stub
		
	}
	
	@Override
	public void close() throws Exception {
		// TODO Auto-generated method stub

	}



}
